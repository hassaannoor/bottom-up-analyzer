import * as vscode from 'vscode';
import { PanelManager } from './panel/PanelManager';

export function activate(context: vscode.ExtensionContext) {
	console.log('Bottom-Up Analyzer is now active!');

	let disposable = vscode.commands.registerCommand('bottom-up-analyzer.start', () => {
		PanelManager.createOrShow(context.extensionUri);
        if (PanelManager.currentPanel) {
            PanelManager.currentPanel.updateGraph();
        }
	});

	context.subscriptions.push(disposable);
}

export function deactivate() {}
