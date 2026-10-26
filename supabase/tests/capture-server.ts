// Test-only serve replacement: import the real handlers without opening a port.
export let handler: (request: Request) => Promise<Response>;
export function serve(callback: typeof handler): void { handler = callback; }
