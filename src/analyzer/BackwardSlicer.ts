import * as vscode from 'vscode';
import * as ts from 'typescript';
import * as path from 'path';
import { AnalyzeNode, AnalyzeEdge, AnalysisResult, ProgressCallback } from './types';
import { LeafDetector } from './LeafDetector';

export class BackwardSlicer {
    private visited = new Set<string>();
    private nodes: Map<string, AnalyzeNode> = new Map();
    private edges: AnalyzeEdge[] = [];
    private depthLimit = 5;
    private timeBudgetMs = 1000; // 1 second time budget
    private analysisStartTime = 0;
    private isTimedOut = false;
    private progressCallback?: ProgressCallback;
    private lastProgressEmitTime = 0;
    private progressEmitIntervalMs = 100; // Emit progress every 100ms
    
    // AST Cache: uri.toString() -> SourceFile
    private static astCache = new Map<string, ts.SourceFile>();
    private static MAX_CACHE_SIZE = 50;

    public async analyze(
        document: vscode.TextDocument, 
        position: vscode.Position,
        progressCallback?: ProgressCallback
    ): Promise<AnalysisResult> {
        this.visited.clear();
        this.nodes.clear();
        this.edges = [];
        this.analysisStartTime = Date.now();
        this.lastProgressEmitTime = this.analysisStartTime;
        this.isTimedOut = false;
        this.progressCallback = progressCallback;
        console.log('BackwardSlicer: Analysis started');

        // 1. Find the leaf function
        const leaf = LeafDetector.getEnclosingFunction(document, position);
        if (!leaf) {
            console.log('BackwardSlicer: No enclosing function found at cursor.');
            throw new Error("No function found at cursor position.");
        }
        console.log(`BackwardSlicer: Found leaf function '${leaf.name}'`);

        const leafNodeId = this.getNodeId(document.uri, leaf.node);
        this.addNode(leafNodeId, leaf.name, document.uri, leaf.node, document);

        // 2. Start slicing from the leaf
        // We need the location of the function *name* to find references
        let nameLocation = leaf.node.getStart();
        if (leaf.nameNode) {
             nameLocation = leaf.nameNode.getStart();
        } else if ((leaf.node as any).name) {
            // Fallback for direct properties
             nameLocation = (leaf.node as any).name.getStart();
        }

        // Convert offset to position for VS Code API
        const namePos = document.positionAt(nameLocation);
        console.log(`BackwardSlicer: Searching for references to '${leaf.name}' starting at`, namePos);

        await this.findCallersRecursive(leafNodeId, document.uri, namePos, 0);

        const elapsedMs = Date.now() - this.analysisStartTime;
        console.log(`BackwardSlicer: Analysis completed in ${elapsedMs}ms${this.isTimedOut ? ' (TIMED OUT - partial results)' : ''}`);
        console.log(`BackwardSlicer: Found ${this.nodes.size} nodes and ${this.edges.length} edges`);

        const result = {
            nodes: Array.from(this.nodes.values()),
            edges: this.edges,
            isPartial: this.isTimedOut,
            timeElapsedMs: elapsedMs
        };
        
        // Emit final update if callback was provided
        if (this.progressCallback) {
            this.progressCallback(result);
        }
        
        return result;
    }

    private async findCallersRecursive(targetNodeId: string, uri: vscode.Uri, position: vscode.Position, depth: number) {
        // Check time budget
        if (Date.now() - this.analysisStartTime > this.timeBudgetMs) {
            if (!this.isTimedOut) {
                console.log('BackwardSlicer: Time budget exceeded, returning partial results');
                this.isTimedOut = true;
            }
            return;
        }
        
        if (depth >= this.depthLimit) return;

        // Use VS Code's Reference Provider
        console.log(`BackwardSlicer: [Depth ${depth}] Executing reference provider for ${uri.fsPath} at ${position.line}:${position.character}`);
        const references = await vscode.commands.executeCommand<vscode.Location[]>(
            'vscode.executeReferenceProvider',
            uri,
            position
        );

        if (!references) {
            console.log(`BackwardSlicer: [Depth ${depth}] No references returned.`);
            return;
        }
        console.log(`BackwardSlicer: [Depth ${depth}] Found ${references.length} raw references.`);

        for (const ref of references) {
            // Skip self-references (definition site or recursive calls within same function for simplicity for now, though recursive calls are valid)
            // Ideally we filter out the definition itself.
            if (ref.uri.toString() === uri.toString() && ref.range.contains(position)) {
                 // console.log(`BackwardSlicer: [Depth ${depth}] Skipping self-reference.`);
                 continue;
            }

            // Open the document of the reference
            const refDoc = await vscode.workspace.openTextDocument(ref.uri);
            
            // Check if this reference is a function call or valid callback usage
            // We use a light AST check
            const isValidRef = this.isValidReferenceUsage(refDoc, ref.range.start);
            if (!isValidRef) continue;

            // Find who is calling
            const caller = LeafDetector.getEnclosingFunction(refDoc, ref.range.start);
            if (caller) {
                // Check if caller is a PropertyAssignment (likely an export object)
                // If so, we skip adding it to the graph but recurse using its references.
                const isProperty = ts.isPropertyAssignment(caller.node) || ts.isShorthandPropertyAssignment(caller.node);
                
                if (isProperty) {
                    console.log(`BackwardSlicer: Skipping export/property node '${caller.name}' but recursing.`);
                    
                    // Recurse: To recurse, we need the position of the CALLER's name
                    let callerNamePos = refDoc.positionAt(caller.node.getStart());
                    if (caller.nameNode) {
                        callerNamePos = refDoc.positionAt(caller.nameNode.getStart());
                    } else if ((caller.node as any).name) {
                        callerNamePos = refDoc.positionAt((caller.node as any).name.getStart());
                    }

                    // Pass the SAME targetNodeId so the next caller links to the original target
                    await this.findCallersRecursive(targetNodeId, ref.uri, callerNamePos, depth); // Don't inc depth effectively? Or do we? Light depth penalty.
                } else {
                    const callerNodeId = this.getNodeId(ref.uri, caller.node);
                    
                    // Add Node
                    if (!this.nodes.has(callerNodeId)) {
                        this.addNode(callerNodeId, caller.name, ref.uri, caller.node, refDoc);
                        
                        // Emit progress update if enough time has passed
                        this.emitProgressIfNeeded();
                        
                        // Recurse: To recurse, we need the position of the CALLER's name
                        let callerNamePos = refDoc.positionAt(caller.node.getStart());
                        if (caller.nameNode) {
                            callerNamePos = refDoc.positionAt(caller.nameNode.getStart());
                        } else if ((caller.node as any).name) {
                            callerNamePos = refDoc.positionAt((caller.node as any).name.getStart());
                        }
                        
                        await this.findCallersRecursive(callerNodeId, ref.uri, callerNamePos, depth + 1);
                    }
    
                    // Add Edge
                    this.edges.push({
                        source: callerNodeId,
                        target: targetNodeId,
                        type: this.isConditional(refDoc, ref.range.start) ? 'conditional' : 'certain'
                    });
                }

            } else {
                // Top-level call or script scope
                 const rootId = `root-${ref.uri.fsPath}-${ref.range.start.line}`;
                 if (!this.nodes.has(rootId)) {
                    this.nodes.set(rootId, {
                        id: rootId,
                        name: path.basename(ref.uri.fsPath), // Use filename instead of 'Script Root'
                        file: ref.uri.fsPath,
                        line: ref.range.start.line,
                        character: ref.range.start.character,
                        isRoot: true
                    });
                 }
                 this.edges.push({
                    source: rootId,
                    target: targetNodeId,
                    type: 'certain'
                 });
            }
        }
    }

    private getNodeId(uri: vscode.Uri, node: ts.Node): string {
        return `${uri.fsPath}:${node.getStart()}`;
    }

    private addNode(id: string, name: string, uri: vscode.Uri, node: ts.Node, document: vscode.TextDocument) {
        const file = uri.fsPath;
        // Calculate line and character
        const pos = document.positionAt(node.getStart());
        
        // If we have a nameNode, maybe point to that?
        // But the LeafDetector returns the function node. 
        // For navigation, the start of the function is distinct enough.
        // Or we could try to find the name location again if we want to be precise.
        // For now, function start is good.

        this.nodes.set(id, {
            id,
            name,
            file,
            line: pos.line, 
            character: pos.character,
            isRoot: false
        });
    }

    private isValidReferenceUsage(document: vscode.TextDocument, position: vscode.Position): boolean {
        const sf = this.getOrCreateSourceFile(document);
        const offset = document.offsetAt(position);
        
        const node = this.getNodeAtOffset(sf, offset);
        if (!node) {
            console.log(`isValidReferenceUsage: No node found at ${offset}`);
            return false;
        }

        console.log(`isValidReferenceUsage: Checking usage for '${node.getText()}' (Kind: ${ts.SyntaxKind[node.kind]})`);

        // Traverse up to find immediately relevant usage
        let current: ts.Node = node;
        while (current.parent) {
             const parent = current.parent;
             console.log(`  -> Parent: ${ts.SyntaxKind[parent.kind]} (${parent.getText().substring(0, 20)}...)`);

             if (ts.isCallExpression(parent) || ts.isNewExpression(parent)) {
                 // Case 1: Direct Call e.g. foo()
                 if (parent.expression === current) {
                     console.log('  -> Match: Direct Call parent.expression === current');
                     return true;
                 }
                 // Case 2: Passed as Argument e.g. use(foo)
                 if (parent.arguments && parent.arguments.some(arg => arg === current)) {
                     console.log('  -> Match: Passed as Argument');
                     return true;
                 }
             }
             
             // Case 3: Assignment to Object Property
             if (ts.isPropertyAssignment(parent) || ts.isShorthandPropertyAssignment(parent)) {
                 console.log('  -> Match: property assignment');
                 return true;
             }

             // Case 4: Binary Expression Assignment
             if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
                 if (parent.right === current) {
                     console.log('  -> Match: Assigned in binary expression');
                     return true;
                 }
             }
             
             if (ts.isBlock(parent) || ts.isSourceFile(parent)) {
                 console.log('  -> Hit Scope (Block/SourceFile), stopping.');
                 break;
             }
             
             current = parent;
        }
        
        console.log('  -> No valid usage found.');
        return false;
    }

    private isConditional(document: vscode.TextDocument, position: vscode.Position): boolean {
        const sf = this.getOrCreateSourceFile(document);
        const offset = document.offsetAt(position);
        
        let path: ts.Node[] = [];
        let found = false;

        function visit(node: ts.Node) {
            if (node.getStart() <= offset && node.getEnd() >= offset) {
                path.push(node);
                if (node.getStart() === offset || (node.getStart() <= offset && node.getEnd() >= offset)) {
                     // Approximate hit
                }
                ts.forEachChild(node, visit);
            }
        }
        visit(sf);
        
        // Walk up path
        // This 'path' logic in simple visit is flawed because it pushes all children.
        // Standard approach: getNodeAtPosition then walk up `.parent`.
        
        let node = this.getNodeAtOffset(sf, offset);
        while (node) {
            if (ts.isIfStatement(node) || ts.isSwitchStatement(node) || ts.isConditionalExpression(node)) {
                return true;
            }
            if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) {
                break; // Stop at function boundary
            }
            node = node.parent;
        }

        return false;
    }

    private getNodeAtOffset(sourceFile: ts.SourceFile, offset: number): ts.Node | null {
        let found: ts.Node | null = null;
        function visit(node: ts.Node) {
            if (node.getStart() <= offset && node.getEnd() >= offset) {
                found = node;
                ts.forEachChild(node, visit);
            }
        }
        visit(sourceFile);
        return found;
    }

    private emitProgressIfNeeded() {
        if (!this.progressCallback) return;
        
        const now = Date.now();
        if (now - this.lastProgressEmitTime >= this.progressEmitIntervalMs) {
            this.lastProgressEmitTime = now;
            this.progressCallback({
                nodes: Array.from(this.nodes.values()),
                edges: this.edges,
                isPartial: true,
                timeElapsedMs: now - this.analysisStartTime
            });
        }
    }

    private getOrCreateSourceFile(document: vscode.TextDocument): ts.SourceFile {
        const key = document.uri.toString();
        const cached = BackwardSlicer.astCache.get(key);
        
        if (cached) {
            // Simple validation: check if text length matches (rough check)
            if (cached.text.length === document.getText().length) {
                return cached;
            }
        }
        
        // Parse and cache
        const sf = ts.createSourceFile(
            document.fileName,
            document.getText(),
            ts.ScriptTarget.Latest,
            true
        );
        
        // Manage cache size
        if (BackwardSlicer.astCache.size >= BackwardSlicer.MAX_CACHE_SIZE) {
            // Simple eviction: delete first entry
            const firstKey = BackwardSlicer.astCache.keys().next().value;
            if (firstKey) {
                BackwardSlicer.astCache.delete(firstKey);
            }
        }
        
        BackwardSlicer.astCache.set(key, sf);
        return sf;
    }

    // Clear cache when documents change significantly
    public static clearCache() {
        BackwardSlicer.astCache.clear();
    }
}
