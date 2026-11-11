import { cache } from "react";
import { sql } from "./db";

/** The current session epoch (kv `session.epoch`, 0 when unset); read once per request. */
export const sessionEpoch = cache(async (): Promise<number> => {
  const [r] = await sql()`select value from kv where key = 'session.epoch'`;
  return Number(r?.value) || 0;
});

/** Log out everywhere: every cookie signed with the old epoch stops working. */
export async function bumpSessionEpoch(): Promise<void> {
  await sql()`insert into kv (key, value) values ('session.epoch', '1'::jsonb)
    on conflict (key) do update set value = to_jsonb(coalesce((kv.value #>> '{}')::int, 0) + 1), updated_at = now()`;
}
