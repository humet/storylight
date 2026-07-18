import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";
import { EmptyState } from "./EmptyState";
import { Button } from "./Button";

const meta = {
  component: EmptyState,
  tags: ["ai-generated"],
  args: {
    title: "Your family library is waiting for its first adventure.",
    description:
      "Every story you make together will live here, ready to read again.",
    action: (
      <Button size="lg" fullWidth>
        Create tonight’s story
      </Button>
    ),
  },
} satisfies Meta<typeof EmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Library: Story = {
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("heading", { name: /first adventure/i }),
    ).toBeVisible();
    // The first useful action is present and obvious.
    await expect(
      canvas.getByRole("button", { name: /create tonight’s story/i }),
    ).toBeVisible();
  },
};

export const Lamplight: Story = {
  parameters: { theme: "dark" },
};

export const Narrow: Story = {
  parameters: { containerWidth: 320 },
};
