import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";
import { StoryCard } from "./StoryCard";

const meta = {
  component: StoryCard,
  tags: ["ai-generated"],
  args: {
    title: "The Lantern in the Garden",
    state: "published",
    href: "#story",
  },
} satisfies Meta<typeof StoryCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Published: Story = {
  play: async ({ canvas }) => {
    const link = canvas.getByRole("link", { name: /lantern/i });
    await expect(link).toHaveAttribute("href", "#story");
    await expect(canvas.getByText(/read again/i)).toBeVisible();
  },
};

export const Generating: Story = {
  args: { title: null, state: "generating" },
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/being written/i)).toBeVisible();
    await expect(canvas.getByText(/tonight's story/i)).toBeVisible();
  },
};

export const Lamplight: Story = {
  parameters: { theme: "dark" },
};

export const Narrow: Story = {
  parameters: { containerWidth: 320 },
};
