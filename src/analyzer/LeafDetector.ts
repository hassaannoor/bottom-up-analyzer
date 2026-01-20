import * as ts from 'typescript';
import * as vscode from 'vscode';

export class LeafDetector {
    public static getEnclosingFunction(document: vscode.TextDocument, position: vscode.Position): { name: string, node: ts.Node, nameNode?: ts.Node } | null {
        const sourceFile = ts.createSourceFile(
            document.fileName,
            document.getText(),
            ts.ScriptTarget.Latest,
            true
        );

        const offset = document.offsetAt(position);
        let foundNode: ts.Node | null = null;
        let foundNameNode: ts.Node | null = null;
        let foundName = '<anonymous>';

        function visit(node: ts.Node) {
            // Ensure strict inequality for parent range check if needed, but standard logic:
            if (node.getStart() <= offset && node.getEnd() >= offset) {
                if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)
                    || ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) {
                    foundNode = node;
                    
                    if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) {
                        if (node.name) {
                            foundName = node.name.getText();
                            foundNameNode = node.name;
                        }
                    } else if (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) {
                         foundName = node.name.getText();
                         foundNameNode = node.name;
                    } else if (node.parent && ts.isVariableDeclaration(node.parent) && node.parent.name) {
                         foundName = node.parent.name.getText();
                         foundNameNode = node.parent.name;
                    } else if (node.parent && ts.isPropertyAssignment(node.parent) && node.parent.name) {
                        // This case handles Arrow Functions inside Property Assignments (visited deeper)
                        foundName = node.parent.name.getText();
                        foundNameNode = node.parent.name;
                    }
                }
                
                // Manual traversal to pass parent down conceptually or link it if createSourceFile didn't (it should with setParentNodes=true in createSourceFile but let's be safe)
                // Actually sourceFile was created with setParentNodes=true (4th arg). 
                // So node.parent SHOULD be defined.
                // Let's rely on that first.
                ts.forEachChild(node, visit);
            }
        }

        visit(sourceFile);

        if (foundNode) {
            return { name: foundName, node: foundNode, nameNode: foundNameNode || undefined };
        }
        return null;
    }
}
