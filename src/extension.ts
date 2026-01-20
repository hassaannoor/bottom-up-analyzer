import * as vscode from 'vscode';
import { SidebarProvider } from './panel/SidebarProvider';

export function activate(context: vscode.ExtensionContext) {
	console.log('Bottom-Up Analyzer is now active!');

    const sidebarProvider = new SidebarProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            SidebarProvider.viewType,
            sidebarProvider
        )
    );

    // Update graph on selection change (cursor move) or document switch
    context.subscriptions.push(
        vscode.window.onDidChangeTextEditorSelection(() => {
            sidebarProvider.updateGraph();
        }),
        vscode.window.onDidChangeActiveTextEditor(() => {
            sidebarProvider.updateGraph();
        })
    );
}

export function deactivate() {}
