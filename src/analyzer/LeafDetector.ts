import * as ts from 'typescript';
import * as vscode from 'vscode';

export class LeafDetector {
    public static getEnclosingFunction(document: vscode.TextDocument, position: vscode.Position): { name: string, node: ts.Node } | null {
        const sourceFile = ts.createSourceFile(
            document.fileName,
            document.getText(),
            ts.ScriptTarget.Latest,
            true
        );

        const offset = document.offsetAt(position);
        let foundNode: ts.Node | null = null;
        let foundName = '<anonymous>';

        function visit(node: ts.Node) {
            if (node.getStart() <= offset && node.getEnd() >= offset) {
                if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
                    foundNode = node;
                    if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) {
                        foundName = node.name?.getText() || foundName;
                    } else if (ts.isVariableDeclaration(node.parent)) {
                         foundName = node.parent.name.getText();
                    }
                }
                ts.forEachChild(node, visit);
            }
        }

        visit(sourceFile);

        if (foundNode) {
            return { name: foundName, node: foundNode };
        }
        return null;
    }
}
