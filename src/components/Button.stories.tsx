import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";
import { Button } from "./Button";

const meta = {
  component: Button,
  tags: ["ai-generated"],
  args: { children: "Continue tonight" },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  play: async ({ canvas, args }) => {
    // The `children` prop is rendered as the button's accessible name.
    await expect(
      canvas.getByRole("button", { name: String(args.children) }),
    ).toBeVisible();
  },
};

export const Secondary: Story = {
  args: { variant: "secondary", children: "Read again" },
};

export const Ghost: Story = {
  args: { variant: "ghost", children: "Choose who appears" },
};

export const Danger: Story = {
  args: { variant: "danger", children: "Retire this story" },
};

export const Large: Story = {
  args: { size: "lg", children: "Create tonight’s story" },
};

export const Disabled: Story = {
  args: { disabled: true, children: "Painting this page" },
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("button", { name: /painting this page/i }),
    ).toBeDisabled();
  },
};

export const Lamplight: Story = {
  args: { children: "Continue tonight" },
  parameters: { theme: "dark" },
};

export const Narrow: Story = {
  args: { fullWidth: true, size: "lg", children: "Create tonight’s story" },
  parameters: { containerWidth: 320 },
};

// The one project-wide CSS proof: primary fill resolves to the Paper accent
// (--accent-strong: #a24e2b). Fails if Tailwind / the token layer did not load.
export const CssCheck: Story = {
  args: { children: "Continue tonight" },
  play: async ({ canvas }) => {
    const button = canvas.getByRole("button", { name: /continue tonight/i });
    await expect(getComputedStyle(button).backgroundColor).toBe(
      "rgb(162, 78, 43)",
    );
  },
};
