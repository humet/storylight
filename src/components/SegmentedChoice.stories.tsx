import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { expect, userEvent } from "storybook/test";
import { SegmentedChoice } from "./SegmentedChoice";

/**
 * `SegmentedChoice` is controlled, so stories wrap it in a tiny stateful host to
 * exercise real selection behaviour under the vitest browser runner.
 */
function DirectnessExample() {
  const [value, setValue] = useState<"direct" | "reflective" | "playful">(
    "direct",
  );
  return (
    <SegmentedChoice
      label="How does this character speak?"
      value={value}
      onValueChange={setValue}
      hint="Guidance for the writer — not a rule to repeat."
      options={[
        { value: "direct", label: "Direct", hint: "Says what they mean" },
        { value: "reflective", label: "Reflective", hint: "Thinks aloud" },
        { value: "playful", label: "Playful", hint: "Teases gently" },
      ]}
    />
  );
}

const meta = {
  component: SegmentedChoice,
  tags: ["ai-generated"],
  // The stateful host renders the real control; args satisfy the required props.
  args: {
    label: "How does this character speak?",
    value: "direct",
    onValueChange: () => {},
    options: [
      { value: "direct", label: "Direct" },
      { value: "reflective", label: "Reflective" },
      { value: "playful", label: "Playful" },
    ],
  },
  render: () => <DirectnessExample />,
} satisfies Meta<typeof SegmentedChoice>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    const direct = canvas.getByRole("radio", { name: /direct/i });
    await expect(direct).toHaveAttribute("aria-checked", "true");

    const playful = canvas.getByRole("radio", { name: /playful/i });
    await userEvent.click(playful);
    await expect(playful).toHaveAttribute("aria-checked", "true");
    await expect(direct).toHaveAttribute("aria-checked", "false");
  },
};

export const Lamplight: Story = {
  parameters: { theme: "dark" },
};

export const Narrow: Story = {
  parameters: { containerWidth: 320 },
};
