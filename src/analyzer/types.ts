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
    // Call site location - where source calls target
    callSite?: {
        file: string;
        line: number;
        character: number;
    };
}

export interface AnalysisResult {
    nodes: AnalyzeNode[];
    edges: AnalyzeEdge[];
    isPartial?: boolean; // True if analysis was stopped early
    timeElapsedMs?: number; // Time taken for analysis
}

export type ProgressCallback = (result: AnalysisResult) => void;
