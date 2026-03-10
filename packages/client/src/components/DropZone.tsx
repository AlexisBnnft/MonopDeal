import { useDroppable } from '@dnd-kit/core';
import type { ReactNode } from 'react';

interface Props {
  id: string;
  className?: string;
  children: ReactNode;
}

export function DropZone({ id, className = '', children }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      className={`drop-zone ${isOver ? 'drop-zone-over' : ''} ${className}`}
    >
      {children}
    </div>
  );
}
