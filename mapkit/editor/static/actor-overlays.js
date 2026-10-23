// Selection ranges live in world space: they follow position, not the actor's
// visual scale/rotation. Sync once before drawing, including live gizmo gestures.
export function createActorOverlayTracker(scene) {
  const owners = new Map();
  function syncOne(overlay, actor) {
    let parent = actor, visible = true;
    while (parent && parent !== scene) {
      visible = visible && parent.visible;
      parent = parent.parent;
    }
    if (parent !== scene) {
      overlay.visible = false;
      owners.delete(overlay); // Deleted/rebuilt proxies must not leave ghost ranges.
      return;
    }
    overlay.visible = visible;
    if (visible) actor.getWorldPosition(overlay.position);
  }
  return {
    bind(overlay, actor, enabled = true) {
      if (!actor || !enabled) {
        owners.delete(overlay);
        overlay.visible = false;
        return;
      }
      owners.set(overlay, actor);
      syncOne(overlay, actor);
    },
    sync() {
      for (const [overlay, actor] of owners) syncOne(overlay, actor);
    },
  };
}
