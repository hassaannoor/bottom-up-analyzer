import * as vscode from 'vscode';
import * as ts from 'typescript';
import { AnalyzeNode, AnalyzeEdge, AnalysisResult } from './types';
import { LeafDetector } from './LeafDetector';

export class BackwardSlicer {
    private visited = new Set<string>();
    private nodes: Map<string, AnalyzeNode> = new Map();
    private edges: AnalyzeEdge[] = [];
    private depthLimit = 5;

    public async analyze(document: vscode.TextDocument, position: vscode.Position): Promise<AnalysisResult> {
        this.visited.clear();
        this.nodes.clear();
        this.edges = [];

        // 1. Find the leaf function
        const leaf = LeafDetector.getEnclosingFunction(document, position);
        if (!leaf) {
            console.log('BackwardSlicer: No enclosing function found at cursor.');
            throw new Error("No function found at cursor position.");
        }
        console.log(`BackwardSlicer: Found leaf function '${leaf.name}'`);

        const leafNodeId = this.getNodeId(document.uri, leaf.node);
        this.addNode(leafNodeId, leaf.name, document.uri, leaf.node);

        // 2. Start slicing from the leaf
        // We need the location of the function *name* to find references
        let nameLocation = leaf.node.getStart();
        if ((leaf.node as any).name) {
             nameLocation = (leaf.node as any).name.getStart();
        }

        // Convert offset to position for VS Code API
        const namePos = document.positionAt(nameLocation);
        console.log(`BackwardSlicer: Searching for references to '${leaf.name}' starting at`, namePos);

        await this.findCallersRecursive(leafNodeId, document.uri, namePos, 0);

        return {
            nodes: Array.from(this.nodes.values()),
            edges: this.edges
        };
    }

    private async findCallersRecursive(targetNodeId: string, uri: vscode.Uri, position: vscode.Position, depth: number) {
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
            
            // Check if this reference is a function call
            // We use a light AST check
            const isCall = this.isCallExpression(refDoc, ref.range.start);
            if (!isCall) continue;

            // Find who is calling
            const caller = LeafDetector.getEnclosingFunction(refDoc, ref.range.start);
            if (caller) {
                const callerNodeId = this.getNodeId(ref.uri, caller.node);
                
                // Add Node
                if (!this.nodes.has(callerNodeId)) {
                    this.addNode(callerNodeId, caller.name, ref.uri, caller.node);
                    
                    // Recurse: To recurse, we need the position of the CALLER's name
                    let callerNamePos = refDoc.positionAt(caller.node.getStart());
                     if ((caller.node as any).name) {
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
            } else {
                // Top-level call or script scope
                 const rootId = `root-${ref.uri.fsPath}-${ref.range.start.line}`;
                 if (!this.nodes.has(rootId)) {
                    this.nodes.set(rootId, {
                        id: rootId,
                        name: 'Script Root',
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

    private addNode(id: string, name: string, uri: vscode.Uri, node: ts.Node) {
        const file = uri.fsPath;
        // Approximation: getting line/char from node start
        // In a real generic parser we'd map this back from sourcefile, 
        // but here we implicitly assume we have the doc or can get it.
        // For efficiency, we store raw start, but for UI we need line/char.
        // We'll defer line/char computation or assume we have it.
        // For MVP let's store 0,0 and fix later or pass document.
        this.nodes.set(id, {
            id,
            name,
            file,
            line: 0, 
            character: 0,
            isRoot: false
        });
    }

    private isCallExpression(document: vscode.TextDocument, position: vscode.Position): boolean {
        // Fast check: get node at position, check if CallExpression
        // Optimization: Don't parse whole file every time.
        // But for MVP, repeated parsing is safer than caching stale ASTs.
        const sf = ts.createSourceFile(document.fileName, document.getText(), ts.ScriptTarget.Latest, true);
        const offset = document.offsetAt(position);
        
        let isCall = false;
        function visit(node: ts.Node) {
            if (node.getStart() <= offset && node.getEnd() >= offset) {
                if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
                    // Check if the identifier being called overlaps with our reference
                    // This logic needs to be precise. 
                    // The 'reference' position is usually the function name.
                    // So if `foo()` is called, reference is on `foo`. 
                    // `foo` is the expression of the CallExpression.
                    if (node.expression.getStart() <= offset && node.expression.getEnd() >= offset) {
                        isCall = true;
                    }
                }
                ts.forEachChild(node, visit);
            }
        }
        visit(sf);
        return isCall;
    }

    private isConditional(document: vscode.TextDocument, position: vscode.Position): boolean {
        const sf = ts.createSourceFile(document.fileName, document.getText(), ts.ScriptTarget.Latest, true);
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
}
