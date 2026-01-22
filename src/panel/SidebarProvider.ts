import * as vscode from 'vscode';
import { BackwardSlicer } from '../analyzer/BackwardSlicer';

export class SidebarProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'bottomUpAnalyzerView';
    private _view?: vscode.WebviewView;
    private readonly _slicer: BackwardSlicer;

    constructor(private readonly _extensionUri: vscode.Uri) {
        this._slicer = new BackwardSlicer();
    }

    private _isNavigating = false;

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
                        this._isNavigating = true;
                        const uri = vscode.Uri.file(data.value.file);
                        const doc = await vscode.workspace.openTextDocument(uri);
                        const pos = new vscode.Position(data.value.line, data.value.character);
                        const editor = await vscode.window.showTextDocument(doc, {
                            preview: true,
                            viewColumn: vscode.ViewColumn.One
                        });
                        
                        editor.selection = new vscode.Selection(pos, pos);
                        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
                        
                        // Reset flag after a delay to allow selection events to fire and be ignored
                        setTimeout(() => {
                            this._isNavigating = false;
                        }, 500);

                    } catch (e) {
                        console.error('Failed to navigate:', e);
                        this._isNavigating = false;
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
        
        if (this._isNavigating) {
            console.log('SidebarProvider: Update skipped due to navigation.');
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
            
            // Enrich nodes with smart relative path for grouping label
            // Strategy:
            // 1. Get relative path for all files.
            // 2. Compute default label: parent/filename
            // 3. Detect collisions.
            // 4. For collisions, use grandparent/parent/filename.
            
            const filePaths = Array.from(new Set(result.nodes.map(n => n.file)));
            const labelMap = new Map<string, string>();
            const labelCounts = new Map<string, string[]>();

            // Pass 1: Default labels
            for (const file of filePaths) {
                const relative = vscode.workspace.asRelativePath(file);
                const parts = relative.split('/'); // or path.sep if specialized, but vscode URI usually forward slash
                
                let label = relative;
                if (parts.length >= 2) {
                    label = parts.slice(-2).join('/');
                }
                
                labelMap.set(file, label);
                
                if (!labelCounts.has(label)) {
                    labelCounts.set(label, []);
                }
                labelCounts.get(label)!.push(file);
            }

            // Pass 2: Resolve collisions
            for (const [label, files] of labelCounts.entries()) {
                if (files.length > 1) {
                    for (const file of files) {
                        const relative = vscode.workspace.asRelativePath(file);
                        const parts = relative.split('/');
                        
                        let newLabel = label;
                        if (parts.length >= 3) {
                            newLabel = parts.slice(-3).join('/');
                        } else {
                            // Can't expand further, stick with full relative path if really needed, or just what we have
                            newLabel = relative;
                        }
                        labelMap.set(file, newLabel);
                    }
                }
            }

            const enrichedNodes = result.nodes.map(n => {
                return { ...n, fileLabel: labelMap.get(n.file) || 'unknown' };
            });

            this._view.webview.postMessage({ type: 'update', data: { ...result, nodes: enrichedNodes } });
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
