import { readFile } from 'node:fs/promises';
export const capabilities = Object.freeze(['all-paths','get-head-range','local-authorization-lease','private-cache','server-session']);
export async function source() {
 return { session:await readFile(new URL('../server/session.mjs',import.meta.url),'utf8'), gate:await readFile(new URL('../server/gate.mjs',import.meta.url),'utf8'), login:await readFile(new URL('../server/login.mjs',import.meta.url),'utf8') };
}
export async function inspect() { return {ok:true}; }
