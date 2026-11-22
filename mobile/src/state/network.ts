// Whether our server is reachable, learned from real requests: any answer from the server (even an
// error status) means "online"; a request that gets no answer means "offline". This is more useful
// than the device's Wi-Fi flag (captive portals and dead towers report "connected" but reach nothing)
// and needs no native module.
let offline = false;
const listeners = new Set<() => void>();

export const networkStore = {
  isOffline: () => offline,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};

export function setOffline(value: boolean): void {
  if (offline === value) return;
  offline = value;
  listeners.forEach((l) => l());
}
