import type { ComponentMeta } from "../lib/meta.ts";
import type { ProseProps } from "./Prose.tsx";

export const meta: ComponentMeta<ProseProps> = {
  args: {
    children: (
      <>
        <h2>How we use it</h2>
        <p>We use what you tell us to suggest one introduction at a time.</p>
        <ul>
          <li>To text you and send reminders you asked for.</li>
          <li>To keep members safe.</li>
        </ul>
      </>
    ),
  },
};
