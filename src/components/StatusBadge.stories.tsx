import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";
import { StatusBadge } from "./StatusBadge";

const meta = {
  component: StatusBadge,
  tags: ["ai-generated"],
  args: { status: "draft" },
} satisfies Meta<typeof StatusBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Draft: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Draft")).toBeVisible();
  },
};

export const Active: Story = {
  args: { status: "active" },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Ready")).toBeVisible();
  },
};

export const Retired: Story = {
  args: { status: "retired" },
};

export const Lamplight: Story = {
  args: { status: "active" },
  parameters: { theme: "dark" },
};

export const Narrow: Story = {
  parameters: { containerWidth: 320 },
};
