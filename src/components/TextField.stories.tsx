import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";
import { TextField } from "./TextField";

const meta = {
  component: TextField,
  tags: ["ai-generated"],
  args: {
    label: "Who is this story for?",
    placeholder: "A name",
  },
} satisfies Meta<typeof TextField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    hint: "This is only used to personalise tonight’s adventure.",
  },
  play: async ({ canvas, args }) => {
    // Proves the label is wired to the input via htmlFor / id.
    const input = canvas.getByLabelText(args.label);
    await expect(input).toBeVisible();
  },
};

export const Required: Story = {
  args: { required: true },
};

export const WithError: Story = {
  args: {
    defaultValue: "",
    error: "Add a name so we know who the hero is.",
  },
  play: async ({ canvas }) => {
    const input = canvas.getByLabelText(/who is this story for/i);
    // The error state must reach assistive technology, not just be visual.
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(canvas.getByText(/who the hero is/i)).toBeVisible();
  },
};

export const Lamplight: Story = {
  args: { hint: "This is only used to personalise tonight’s adventure." },
  parameters: { theme: "dark" },
};

export const Narrow: Story = {
  args: { hint: "Comfortable at the smallest phone width." },
  parameters: { containerWidth: 320 },
};
