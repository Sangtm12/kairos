import express from "express";

const app = express();
const port = Number(process.env.port ?? 3000);

app.get("/health", (req, res) => {
  return res.status(200).json({ status: "ok" });
});

app.listen(port, () => {
  console.log(`app listening on port ${port}`);
});
