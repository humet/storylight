import type { Preview, Decorator } from "@storybook/nextjs-vite";
import "../src/app/globals.css";

/**
 * Wraps every story in a themed Storylight surface. Theme comes from the
 * story's `theme` parameter (falling back to the toolbar global, then light),
 * so `Light` / `Dark` stories are deterministic under vitest. An optional
 * `containerWidth` parameter constrains the surface for the 320px stories.
 */
const withStorylightSurface: Decorator = (Story, context) => {
  const theme =
    (context.parameters.theme as "light" | "dark" | undefined) ??
    (context.globals.theme as "light" | "dark" | undefined) ??
    "light";
  const width = context.parameters.containerWidth as number | undefined;

  return (
    <div
      data-theme={theme}
      style={width ? { width } : undefined}
      className="bg-canvas text-ink"
    >
      <div style={{ padding: "1.5rem" }}>
        <Story />
      </div>
    </div>
  );
};

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },

    a11y: {
      // 'todo' - show a11y violations in the test UI only
      // 'error' - fail CI on a11y violations
      // 'off' - skip a11y checks entirely
      test: "todo",
    },
  },

  globalTypes: {
    theme: {
      description: "Storylight theme",
      defaultValue: "light",
      toolbar: {
        title: "Theme",
        icon: "circlehollow",
        items: [
          { value: "light", title: "Paper (light)" },
          { value: "dark", title: "Lamplight (dark)" },
        ],
        dynamicTitle: true,
      },
    },
  },

  initialGlobals: { theme: "light" },

  decorators: [withStorylightSurface],
};

export default preview;
