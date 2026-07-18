import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";
import { ProgressStage } from "./ProgressStage";

const meta = {
  component: ProgressStage,
  tags: ["ai-generated"],
  args: {
    label: "Writing tonight's chapter",
    state: "working",
    hint: "You can leave this page — the story will be here when it is ready.",
  },
} satisfies Meta<typeof ProgressStage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Working: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/writing tonight's chapter/i)).toBeVisible();
  },
};

export const WithTitle: Story = {
  args: { title: "The Lantern in the Garden", label: "Checking the story" },
};

export const Failed: Story = {
  args: {
    state: "failed",
    label:
      "This story did not come together. Nothing was saved, and you can try again.",
    hint: undefined,
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/did not come together/i)).toBeVisible();
  },
};

export const Lamplight: Story = {
  parameters: { theme: "dark" },
};

export const Narrow: Story = {
  parameters: { containerWidth: 320 },
};
