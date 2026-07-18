import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";
import { TextArea } from "./TextArea";

const meta = {
  component: TextArea,
  tags: ["ai-generated"],
  args: {
    label: "How does this show up?",
    placeholder: "One idea per line",
  },
} satisfies Meta<typeof TextArea>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    hint: "Little moments the story can lean on, not a label.",
  },
  play: async ({ canvas, args }) => {
    const field = canvas.getByLabelText(args.label);
    await expect(field).toBeVisible();
  },
};

export const Required: Story = {
  args: { required: true },
};

export const WithError: Story = {
  args: {
    error: "Add a little more so the writer has something to picture.",
  },
  play: async ({ canvas }) => {
    const field = canvas.getByLabelText(/how does this show up/i);
    await expect(field).toHaveAttribute("aria-invalid", "true");
  },
};

export const Lamplight: Story = {
  args: { hint: "Comfortable to read in dim light." },
  parameters: { theme: "dark" },
};

export const Narrow: Story = {
  args: { hint: "Works at the smallest phone width." },
  parameters: { containerWidth: 320 },
};
