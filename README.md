<div align="center">
  <img src="https://github.com/user-attachments/assets/84ed6842-90f8-441b-a9d6-001415a2701b" width="128" height="128" alt="cutlist logo" />

# cutlist

**Plan your cuts without the fuss.**  
 A fast, free, online cut list optimizer for sheet goods (2D) and linear stock (1D).

[Try the Tool](https://cutlist.walkersutton.com)

</div>

---

**cutlist** is a simple yet powerful tool designed for woodworkers and DIYers to optimize their material usage. Whether you are dealing with plywood sheets (2D) or lumber boards (1D), this tool helps you find the most efficient way to layout your cuts.

## Features

- **2D Optimization**: Layout panels on sheet goods (plywood, MDF, etc.).
- **1D Optimization**: Layout pieces on linear stock (boards, pipes, extrusions).
- **Kerf Support**: Account for the blade width in your calculations.
- **Grain Direction**: Respect wood grain or pattern orientation for both sheets and panels.
- **Local Persistence**: Your project state is automatically saved to your browser's local storage.
- **Responsive Design**: Works great on both desktop and mobile devices.

## How to use locally

If you want to run **cutlist** in your own environment:

1. Clone the repository.
2. Install dependencies:
   ```bash
   pnpm install
   ```
3. Start the development server:
   ```bash
   pnpm dev
   ```
4. Open your browser to the URL shown in the terminal (usually `http://localhost:5173`).

## Tools i tried

I built this because other tools often felt slow or over-complicated:

- [CutList Optimizer](https://www.cutlistoptimizer.com/) - slow
- [optiCutter](https://www.opticutter.com/) - slow
- [CutlistEvo](https://cutlistevo.com/) - didn't attempt to try; seemed too complicated

While some of these tools offer more advanced features, they can often be cumbersome to use. I am open to implementing more advanced functionality into **cutlist** as long as it doesn't compromise the clean, simple user experience.

Have an idea for a feature? [Open a GitHub Issue](https://github.com/walkersutton/cutlist/issues/new) to suggest it!
