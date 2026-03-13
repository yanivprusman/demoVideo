type Subscriber = (data: Record<string, unknown>) => void;

const subscribers = new Set<Subscriber>();

export function subscribe(callback: Subscriber): () => void {
  subscribers.add(callback);
  return () => subscribers.delete(callback);
}

export function broadcast(data: Record<string, unknown>) {
  for (const cb of subscribers) {
    try { cb(data); } catch { /* subscriber gone */ }
  }
}
