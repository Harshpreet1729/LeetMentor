export default {
  content: ["./index.html", "./options.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        forest: {
          50: "#f1f8e9",
          100: "#e3f2d8",
          200: "#c6e5b0",
          300: "#a5d6a7",
          400: "#7ac67c",
          500: "#66bb6a",
          600: "#4f9f57",
          700: "#2e7d32",
          800: "#215b25",
          900: "#18251d"
        }
      },
      boxShadow: {
        bloom: "0 18px 45px rgba(46, 125, 50, 0.22)"
      },
      fontFamily: {
        display: ["Segoe UI", "sans-serif"]
      }
    }
  },
  plugins: []
};
