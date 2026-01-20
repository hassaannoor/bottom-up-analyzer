import React, { useEffect, useState, useCallback } from 'react';
import ReactFlow, { 
    Node, 
    Edge, 
    Background, 
    Controls, 
    useNodesState, 
    useEdgesState,
    MarkerType
} from 'reactflow';
import 'reactflow/dist/style.css';

// VS Code API injection
declare const acquireVsCodeApi: () => any;
const vscode = acquireVsCodeApi();

const initialNodes: Node[] = [];
const initialEdges: Edge[] = [];

export default function App() {
    const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
    const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            console.log('[Webview] Received message:', message);
            switch (message.type) {
                case 'update':
                    const { nodes: rawNodes, edges: rawEdges } = message.data;
                    console.log('[Webview] Updating state with nodes:', rawNodes.length, 'edges:', rawEdges.length);
                    
                    // Simple layout: tree structure
                    // For MVP just vertical spacing or ELK later. 
                    // Let's do a naive manual layout for now or just random.
                    // Ideally use a layout library like dagre. 
                    // For now, let's just place them linearly or randomly to verify data connectivity.
                   
                    const newNodes: Node[] = rawNodes.map((n: any, index: number) => ({
                        id: n.id,
                        position: { x: 250, y: index * 100 },
                        data: { label: n.name },
                        style: n.isRoot ? { background: '#ffcccc' } : undefined
                    }));

                    const newEdges: Edge[] = rawEdges.map((e: any) => ({
                        id: `${e.source}-${e.target}`,
                        source: e.source,
                        target: e.target,
                        label: e.type === 'conditional' ? '?' : undefined,
                        animated: e.type === 'conditional',
                        style: { stroke: e.type === 'conditional' ? 'orange' : 'black' },
                        markerEnd: { type: MarkerType.ArrowClosed }
                    }));

                    setNodes(newNodes);
                    setEdges(newEdges);
                    break;
            }
        };

        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, [setNodes, setEdges]);

    return (
        <div style={{ height: '100vh', width: '100%' }}>
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                fitView
            >
                <Background />
                <Controls />
            </ReactFlow>
        </div>
    );
}
