import React, { useEffect, useState, useCallback, useRef } from 'react';
import ReactFlow, { 
    Node, 
    Edge, 
    Background, 
    Controls, 
    useNodesState, 
    useEdgesState,
    MarkerType,
    ReactFlowInstance
} from 'reactflow';
import 'reactflow/dist/style.css';

import * as dagre from 'dagre';

// VS Code API injection
declare const acquireVsCodeApi: () => any;
const vscode = acquireVsCodeApi();

const initialNodes: Node[] = [];
const initialEdges: Edge[] = [];

const getClusteredLayout = (nodes: any[], edges: any[], direction = 'TB') => {
    // 1. Group nodes by file
    const fileGroups: Record<string, any[]> = {};
    nodes.forEach(node => {
        const key = node.data.fileLabel || 'unknown';
        if (!fileGroups[key]) fileGroups[key] = [];
        fileGroups[key].push(node);
    });

    const layoutedNodes: Node[] = [];
    const groupNodes: Node[] = [];

    // Direction for external graph: TB (Top-Bottom)
    // Direction for internal graph: TB
    
    // Outer graph (Nodes = Files)
    const outerGraph = new dagre.graphlib.Graph();
    outerGraph.setGraph({ rankdir: direction, nodesep: 50, ranksep: 50 });
    outerGraph.setDefaultEdgeLabel(() => ({}));

    // 2. Layout internals of each group to determine group sizes
    Object.entries(fileGroups).forEach(([fileLabel, groupMembers]) => {
        const innerGraph = new dagre.graphlib.Graph();
        innerGraph.setGraph({ rankdir: 'TB', nodesep: 20, ranksep: 20 }); // Keep methods tight
        innerGraph.setDefaultEdgeLabel(() => ({}));

        // Add nodes to inner graph
        groupMembers.forEach(node => {
            innerGraph.setNode(node.id, { width: 180, height: 40 });
        });

        // Add internal edges (edges where both source and target are in this group)
        edges.forEach(edge => {
            const sourceInGroup = groupMembers.find(n => n.id === edge.source);
            const targetInGroup = groupMembers.find(n => n.id === edge.target);
            if (sourceInGroup && targetInGroup) {
                innerGraph.setEdge(edge.source, edge.target);
            }
        });

        dagre.layout(innerGraph);

        // Calculate group bounding box
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        
        groupMembers.forEach(node => {
            const n = innerGraph.node(node.id);
            if (!n) return; // Skip if dagre didn't layout this node
            
            // Position relative to group
            const x = n.x - 180 / 2;
            const y = n.y - 40 / 2;
            
            // Adjust bounds (dagre centers at 0,0 conceptually for the graph usually)
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x + 180 > maxX) maxX = x + 180;
            if (y + 40 > maxY) maxY = y + 40;

            // Push the node with RELATIVE position (will be child of group)
            layoutedNodes.push({
                ...node,
                position: { x: x, y: y }, // Temporary, will shift to be positive relative to group
                parentNode: fileLabel, // Link to group
                extent: 'parent',
                expandParent: true
            });
        });
        
        // Dagre coordinates might start anywhere. Normalize inner nodes so top-left is at padding.
        const padding = 40; // Title space
        // Handle case where no nodes were laid out
        const groupWidth = (minX === Infinity || maxX === -Infinity) ? 200 : (maxX - minX) + 20;
        const groupHeight = (minY === Infinity || maxY === -Infinity) ? 100 : (maxY - minY) + 50;

        // Shift all children to be positive within the group
        layoutedNodes.forEach(node => {
            if (node.parentNode === fileLabel && minX !== Infinity && minY !== Infinity) {
                node.position.x = (node.position.x - minX) + 10;
                node.position.y = (node.position.y - minY) + 40;
            }
        });

        // Set dimensions for Outer Graph node
        outerGraph.setNode(fileLabel, { width: groupWidth, height: groupHeight });
    });

    // 3. Add edges to Outer Graph (aggregating connections)
    edges.forEach(edge => {
        const sourceNode = nodes.find(n => n.id === edge.source);
        const targetNode = nodes.find(n => n.id === edge.target);
        if (sourceNode && targetNode) {
            const sourceFile = sourceNode.data.fileLabel || 'unknown';
            const targetFile = targetNode.data.fileLabel || 'unknown';
            
            if (sourceFile !== targetFile) {
                outerGraph.setEdge(sourceFile, targetFile);
            }
        }
    });

    // 4. Layout Outer Graph
    dagre.layout(outerGraph);

    // 5. Create Group Nodes
    outerGraph.nodes().forEach(fileLabel => {
        const n = outerGraph.node(fileLabel);
        groupNodes.push({
            id: fileLabel,
            data: { label: fileLabel },
            position: { x: n.x - n.width / 2, y: n.y - n.height / 2 },
            style: { 
                backgroundColor: 'rgba(255, 255, 255, 0.05)', 
                width: n.width, 
                height: n.height,
                border: '1px dashed #555',
                borderRadius: '4px',
                color: '#aaa',
                fontWeight: 'bold',
                paddingTop: '10px'
            },
            type: 'group',
            draggable: false  // Prevent dragging group nodes too
        });
    });

    return { nodes: [...groupNodes, ...layoutedNodes], edges };
};

const GroupNode = ({ data, style }: any) => {
    return (
        <div style={{ ...style, position: 'relative', overflow: 'visible' }}>
            <div style={{ 
                position: 'absolute', 
                top: -24, 
                left: 0, 
                padding: '4px 8px', 
                fontSize: 12, 
                fontWeight: 'bold', 
                color: '#aaa',
                background: '#1e1e1e',
                borderRadius: 4,
                border: '1px solid #444',
                whiteSpace: 'nowrap',
                zIndex: 10
            }}>
                {data.label}
            </div>
        </div>
    );
};

export default function App() {
    const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
    const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
    const reactFlowInstance = useRef<ReactFlowInstance | null>(null);

    const nodeTypes = React.useMemo(() => ({ group: GroupNode }), []);

    const onNodeClick = useCallback((event: React.MouseEvent, node: Node) => {
        if (node.data && node.data.payload) {
             vscode.postMessage({
                type: 'navigate',
                value: node.data.payload
            });
        }
    }, []);

    const setInstance = useCallback((instance: ReactFlowInstance) => {
        reactFlowInstance.current = instance;
    }, []);

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            switch (message.type) {
                case 'update':
                    const { nodes: rawNodes, edges: rawEdges } = message.data;
                    
                    const flowNodes: Node[] = rawNodes.map((n: any) => {
                        // Find first outgoing edge to get call site location
                        const outgoingEdge = rawEdges.find((e: any) => e.source === n.id);
                        return {
                        id: n.id,
                        position: { x: 0, y: 0 },
                        data: { 
                            label: n.name,
                            fileLabel: n.fileLabel,
                            payload: outgoingEdge?.callSite || { file: n.file, line: n.line, character: n.character }
                        },
                        style: n.isRoot ? { background: '#5c2b2b', color: '#fff', border: '1px solid #ff9999' } : 
                                          { background: '#1e1e1e', color: '#fff', border: '1px solid #777' }, // Dark theme friendly
                        type: 'default',
                        draggable: false  // Prevent dragging to avoid artifacts with parent-child nodes
                    };
                    });

                    const flowEdges: Edge[] = rawEdges.map((e: any) => ({
                        id: `${e.source}-${e.target}`,
                        source: e.source,
                        target: e.target,
                        label: e.type === 'conditional' ? '?' : undefined,
                        animated: true,
                        style: { 
                            stroke: e.type === 'conditional' ? '#ff9900' : '#888',
                            strokeDasharray: '5,5',
                            strokeWidth: 2
                        },
                        markerEnd: { type: MarkerType.ArrowClosed, color: e.type === 'conditional' ? '#ff9900' : '#888' }
                    }));
                    
                    const { nodes: layoutNodes, edges: layoutEdges } = getClusteredLayout(
                        flowNodes,
                        flowEdges,
                        'TB'
                    );

                    setNodes(layoutNodes);
                    setEdges(layoutEdges);
                    
                    // Auto-fit view after layout is complete
                    setTimeout(() => {
                        if (reactFlowInstance.current) {
                            reactFlowInstance.current.fitView({ padding: 0.2, duration: 300 });
                        }
                    }, 50);
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
                nodeTypes={nodeTypes}
                proOptions={{ hideAttribution: true }}
                onInit={setInstance}
                fitView
            >
                <Background />
                <Controls />
            </ReactFlow>
        </div>
    );
}
