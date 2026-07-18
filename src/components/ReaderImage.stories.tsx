import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";
import { ReaderImage } from "./ReaderImage";

const meta = {
  component: ReaderImage,
  tags: ["ai-generated"],
  args: {
    caption: "Rosa lifts the lantern and the garden glows softly.",
    aspect: "landscape",
  },
} satisfies Meta<typeof ReaderImage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Pending: Story = {
  args: { status: "pending" },
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/rosa lifts the lantern/i)).toBeVisible();
    await expect(canvas.getByText(/painting this page/i)).toBeVisible();
  },
};

export const Failed: Story = {
  args: { status: "failed" },
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/resting for now/i)).toBeVisible();
  },
};

export const Portrait: Story = {
  args: { aspect: "portrait" },
};

export const Lamplight: Story = {
  parameters: { theme: "dark" },
};

export const Narrow: Story = {
  parameters: { containerWidth: 320 },
};
