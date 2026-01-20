import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
	console.log('Bottom-Up Analyzer is now active!');

	let disposable = vscode.commands.registerCommand('bottom-up-analyzer.start', () => {
		vscode.window.showInformationMessage('Bottom-Up Analyzer Started');
        // Logic to trigger analysis will go here
	});

	context.subscriptions.push(disposable);
}

export function deactivate() {}
