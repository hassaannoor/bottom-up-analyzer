import * as vscode from 'vscode';
import * as path from 'path';
import { BackwardSlicer } from '../analyzer/BackwardSlicer';

export class PanelManager {
    public static currentPanel: PanelManager | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private readonly _slicer: BackwardSlicer;
    private _disposables: vscode.Disposable[] = [];

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._slicer = new BackwardSlicer();

        this._update();

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    }

    public static createOrShow(extensionUri: vscode.Uri) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (PanelManager.currentPanel) {
            PanelManager.currentPanel._panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'bottomUpAnalyzer',
            'Bottom-Up Analysis',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(extensionUri, 'out')
                ]
            }
        );

        PanelManager.currentPanel = new PanelManager(panel, extensionUri);
    }

    public async updateGraph() {
        // Trigger analysis from current editor cursor
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        try {
            const result = await this._slicer.analyze(editor.document, editor.selection.active);
            this._panel.webview.postMessage({ type: 'update', data: result });
        } catch (e: any) {
            vscode.window.showErrorMessage(`Analysis failed: ${e.message}`);
        }
    }

    private _update() {
        this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'out', 'webview.js'));

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Bottom-Up Analyzer</title>
                <style>
                    body { margin: 0; padding: 0; height: 100vh; overflow: hidden; background-color: var(--vscode-editor-background); color: var(--vscode-editor-foreground); }
                    #root { height: 100%; width: 100%; }
                </style>
            </head>
            <body>
                <div id="root"></div>
                <script src="${scriptUri}"></script>
            </body>
            </html>`;
    }

    public dispose() {
        PanelManager.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }
}
