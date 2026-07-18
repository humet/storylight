import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";
import { ErrorState } from "./ErrorState";
import { Button } from "./Button";

const meta = {
  component: ErrorState,
  tags: ["ai-generated"],
  args: {
    title: "This chapter did not come together properly.",
    description:
      "Nothing was lost, and the rest of the series is exactly as you left it.",
    reassurance: "Your series is safe",
    action: (
      <Button size="lg" fullWidth>
        Try again
      </Button>
    ),
  },
} satisfies Meta<typeof ErrorState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ChapterFailed: Story = {
  play: async ({ canvas }) => {
    // The whole surface announces itself calmly as an alert.
    const alert = canvas.getByRole("alert");
    await expect(alert).toHaveTextContent(/your series is safe/i);
    await expect(
      canvas.getByRole("button", { name: /try again/i }),
    ).toBeVisible();
  },
};

export const Lamplight: Story = {
  parameters: { theme: "dark" },
};

export const Narrow: Story = {
  parameters: { containerWidth: 320 },
};
