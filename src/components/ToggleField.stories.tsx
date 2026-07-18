import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { expect, userEvent } from "storybook/test";
import { ToggleField } from "./ToggleField";

function MagicExample() {
  const [checked, setChecked] = useState(true);
  return (
    <ToggleField
      label="A little magic is welcome"
      description="Stories may include gentle, wondrous magic."
      checked={checked}
      onCheckedChange={setChecked}
    />
  );
}

const meta = {
  component: ToggleField,
  tags: ["ai-generated"],
  // The stateful host renders the real control; args satisfy the required props.
  args: {
    label: "A little magic is welcome",
    checked: true,
    onCheckedChange: () => {},
  },
  render: () => <MagicExample />,
} satisfies Meta<typeof ToggleField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    const toggle = canvas.getByRole("switch", { name: /a little magic/i });
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await userEvent.click(toggle);
    await expect(toggle).toHaveAttribute("aria-checked", "false");
  },
};

export const Lamplight: Story = {
  parameters: { theme: "dark" },
};

export const Narrow: Story = {
  parameters: { containerWidth: 320 },
};
