import * as vscode from 'vscode';
import { BackwardSlicer } from '../analyzer/BackwardSlicer';

export class SidebarProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'bottomUpAnalyzerView';
    private _view?: vscode.WebviewView;
    private readonly _slicer: BackwardSlicer;

    constructor(private readonly _extensionUri: vscode.Uri) {
        this._slicer = new BackwardSlicer();
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                this._extensionUri
            ]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'navigate': {
                    if (!data.value) return;
                    try {
                        const uri = vscode.Uri.file(data.value.file);
                        const doc = await vscode.workspace.openTextDocument(uri);
                        // TS position is 0-indexed? check types.
                        // We stored node start/end or line. If we stored line, use it.
                        // Our AnalyzeNode currently has line/char.
                        const pos = new vscode.Position(data.value.line, data.value.character);
                        const editor = await vscode.window.showTextDocument(doc, {
                            preview: true,
                            viewColumn: vscode.ViewColumn.One
                        });
                        
                        editor.selection = new vscode.Selection(pos, pos);
                        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
                    } catch (e) {
                        console.error('Failed to navigate:', e);
                    }
                    break;
                }
            }
        });
    }

    public async updateGraph() {
        if (!this._view) {
            return;
        }

        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        // Only analyze if it's a TS/JS file to avoid noise? 
        // Or just let slicer try and fail gracefully.
        
        console.log(`SidebarProvider: Starting analysis on ${editor.document.fileName}`);

        try {
            const result = await this._slicer.analyze(editor.document, editor.selection.active);
            this._view.webview.postMessage({ type: 'update', data: result });
        } catch (e: any) {
            // console.error(e); 
            // Don't toast error on every click if it fails (e.g. whitespace)
            // Just maybe log?
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'out', 'webview.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'out', 'webview.css'));

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <link href="${styleUri}" rel="stylesheet">
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
}
