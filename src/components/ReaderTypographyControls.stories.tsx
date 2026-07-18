import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";
import { ReaderTypographyControls } from "./ReaderTypographyControls";

const meta = {
  component: ReaderTypographyControls,
  tags: ["ai-generated"],
} satisfies Meta<typeof ReaderTypographyControls>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    const group = canvas.getByRole("radiogroup", { name: /text size/i });
    await expect(group).toBeVisible();
    const larger = canvas.getByRole("radio", { name: /larger/i });
    await larger.click();
    await expect(larger).toHaveAttribute("aria-checked", "true");
  },
};

export const Lamplight: Story = {
  parameters: { theme: "dark" },
};
