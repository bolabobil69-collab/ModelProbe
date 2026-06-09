// dragdrop.js — drag-and-drop reordering helpers (global scope after build)
let _ddDraggingId = null;
let _ddOnDrop     = null;

export function ddSetOnDrop(fn) { _ddOnDrop = fn; }

export function ddHandleDragStart(e, id) {
  _ddDraggingId = id;
  e.dataTransfer.effectAllowed = 'move';
  e.currentTarget.classList.add('dd-dragging');
}

export function ddHandleDragEnd(e) {
  e.currentTarget.classList.remove('dd-dragging');
  document.querySelectorAll('.dd-drag-over').forEach(el => el.classList.remove('dd-drag-over'));
  _ddDraggingId = null;
}

export function ddHandleDragOver(e, id) {
  if (!_ddDraggingId || _ddDraggingId === id) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  e.currentTarget.classList.add('dd-drag-over');
}

export function ddHandleDragLeave(e) {
  e.currentTarget.classList.remove('dd-drag-over');
}

export function ddHandleDrop(e, targetId) {
  e.preventDefault();
  e.currentTarget.classList.remove('dd-drag-over');
  if (_ddDraggingId && _ddDraggingId !== targetId && _ddOnDrop) {
    _ddOnDrop(_ddDraggingId, targetId);
  }
  _ddDraggingId = null;
}
