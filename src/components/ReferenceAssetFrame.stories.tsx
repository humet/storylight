import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";
import { ReferenceAssetFrame } from "./ReferenceAssetFrame";

// A self-contained placeholder so the story renders without a live delivery route.
const SAMPLE_SRC =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><rect width="300" height="400" fill="hsl(30 55% 82%)"/><text x="150" y="210" text-anchor="middle" font-family="Georgia" font-size="120" fill="hsl(20 45% 34%)">R</text></svg>`,
  );

const meta = {
  component: ReferenceAssetFrame,
  tags: ["ai-generated"],
  args: {
    src: SAMPLE_SRC,
    alt: "Rosa — Front portrait",
    caption: "Front portrait",
    aspect: "portrait",
  },
} satisfies Meta<typeof ReferenceAssetFrame>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Portrait: Story = {
  play: async ({ canvas }) => {
    const image = canvas.getByRole("img", { name: /rosa — front portrait/i });
    await expect(image).toBeVisible();
    await expect(canvas.getByText("Front portrait")).toBeVisible();
  },
};

export const Landscape: Story = {
  args: {
    aspect: "landscape",
    alt: "Rosa — Expressions",
    caption: "Expressions",
  },
};

export const Lamplight: Story = {
  parameters: { theme: "dark" },
};

export const Narrow: Story = {
  parameters: { containerWidth: 320 },
};
