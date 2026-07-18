import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";
import { CharacterCard } from "./CharacterCard";

const meta = {
  component: CharacterCard,
  tags: ["ai-generated"],
  args: {
    displayName: "Rosa",
    status: "active",
    apparentAge: 7,
    traitCount: 3,
    href: "#rosa",
  },
} satisfies Meta<typeof CharacterCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Active: Story = {
  play: async ({ canvas }) => {
    const link = canvas.getByRole("link", { name: /rosa/i });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", "#rosa");
    await expect(canvas.getByText(/3 traits/i)).toBeVisible();
  },
};

export const Draft: Story = {
  args: { displayName: "Milo", status: "draft", apparentAge: 5, traitCount: 1 },
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/1 trait$/i)).toBeVisible();
  },
};

export const Retired: Story = {
  args: { displayName: "Old Bram", status: "retired", apparentAge: 60 },
};

export const Lamplight: Story = {
  parameters: { theme: "dark" },
};

export const Narrow: Story = {
  parameters: { containerWidth: 320 },
};
