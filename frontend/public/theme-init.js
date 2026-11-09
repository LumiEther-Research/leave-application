// Runs before the page paints. Keep in step with src/lib/theme.tsx (same storage key, same rule).
(function () {
  try {
    var saved = localStorage.getItem("theme");
    var dark = saved === "dark" || ((saved === null || saved === "system") && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  } catch (e) {
    /* storage blocked: stay on the default theme */
  }
})();
