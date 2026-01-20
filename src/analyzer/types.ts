import * as vscode from 'vscode';

export type NodeId = string;

export interface AnalyzeNode {
    id: NodeId;
    name: string;
    file: string;
    line: number;
    character: number;
    isRoot: boolean;
}

export interface AnalyzeEdge {
    source: NodeId;
    target: NodeId;
    type: 'certain' | 'conditional';
    conditionLabel?: string;
}

export interface AnalysisResult {
    nodes: AnalyzeNode[];
    edges: AnalyzeEdge[];
}
