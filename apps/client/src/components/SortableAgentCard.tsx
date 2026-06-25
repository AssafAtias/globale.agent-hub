import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { type Agent } from '../api/client.js';
import { AgentCard } from './AgentCard.js';

interface Props { agent: Agent; onEdit: (id: string) => void; }

export function SortableAgentCard({ agent, onEdit }: Props) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: agent.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
    zIndex: isDragging ? 1 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <AgentCard
        agent={agent}
        onEdit={onEdit}
        dragHandleProps={{ ...attributes, ...listeners, ref: setActivatorNodeRef }}
      />
    </div>
  );
}
