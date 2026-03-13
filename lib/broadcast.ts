type Subscriber = (data: Record<string, unknown>) => void;

function getSubscribers(): Set<Subscriber> {
  const g = globalThis as unknown as { __demoVideoBroadcastSubs?: Set<Subscriber> };
  if (!g.__demoVideoBroadcastSubs) g.__demoVideoBroadcastSubs = new Set();
  return g.__demoVideoBroadcastSubs;
}

export function subscribe(callback: Subscriber): () => void {
  const subscribers = getSubscribers();
  subscribers.add(callback);
  return () => subscribers.delete(callback);
}

export function broadcast(data: Record<string, unknown>) {
  for (const cb of getSubscribers()) {
    try { cb(data); } catch { /* subscriber gone */ }
  }
}
