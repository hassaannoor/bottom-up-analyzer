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

import * as dagre from 'dagre';

// VS Code API injection
declare const acquireVsCodeApi: () => any;
const vscode = acquireVsCodeApi();

const initialNodes: Node[] = [];
const initialEdges: Edge[] = [];

const getLayoutedElements = (nodes: any[], edges: any[], direction = 'BT') => {
    const dagreGraph = new dagre.graphlib.Graph();
    dagreGraph.setDefaultEdgeLabel(() => ({}));
  
    const nodeWidth = 172;
    const nodeHeight = 36;
  
    dagreGraph.setGraph({ rankdir: direction });
  
    nodes.forEach((node) => {
      dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight });
    });
  
    edges.forEach((edge) => {
      dagreGraph.setEdge(edge.source, edge.target);
    });
  
    dagre.layout(dagreGraph);
  
    const layoutedNodes = nodes.map((node) => {
      const nodeWithPosition = dagreGraph.node(node.id);
      return {
          ...node,
          targetPosition: 'top',
          sourcePosition: 'bottom',
          position: {
            x: nodeWithPosition.x - nodeWidth / 2,
            y: nodeWithPosition.y - nodeHeight / 2,
          },
      };

    });
  
    return { nodes: layoutedNodes, edges };
  };

export default function App() {
    const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
    const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

    const onNodeClick = useCallback((event: React.MouseEvent, node: Node) => {
        // Send message to VS Code
        if (node.data && node.data.payload) {
             vscode.postMessage({
                type: 'navigate',
                value: node.data.payload
            });
        }
    }, []);

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            switch (message.type) {
                case 'update':
                    const { nodes: rawNodes, edges: rawEdges } = message.data;
                    
                    const flowNodes: Node[] = rawNodes.map((n: any) => ({
                        id: n.id,
                        position: { x: 0, y: 0 }, // Set by dagre
                        data: { 
                            label: n.name,
                            payload: { file: n.file, line: n.line, character: n.character } 
                        },
                        style: n.isRoot ? { background: '#ffcccc' } : undefined,
                        type: 'input' // or default
                    }));

                    const flowEdges: Edge[] = rawEdges.map((e: any) => ({
                        id: `${e.source}-${e.target}`,
                        source: e.source,
                        target: e.target,
                        label: e.type === 'conditional' ? '?' : undefined,
                        animated: e.type === 'conditional',
                        style: { stroke: e.type === 'conditional' ? 'orange' : '#555' },
                        markerEnd: { type: MarkerType.ArrowClosed }
                    }));
                    
                    // Direction BT: Bottom to Top (Leaf at bottom, roots at top)
                    // Or TB: Top to Bottom. Backward slicing usually implies Leaf at bottom? 
                    // Let's try BT first.
                    const { nodes: layoutNodes, edges: layoutEdges } = getLayoutedElements(
                        flowNodes,
                        flowEdges,
                        'BT'
                    );

                    setNodes(layoutNodes);
                    setEdges(layoutEdges);
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
                onNodeClick={onNodeClick}
                proOptions={{ hideAttribution: true }}
                fitView
            >
                <Background />
                <Controls />
            </ReactFlow>
        </div>
    );
}
