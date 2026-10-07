require("dotenv").config();

const express = require("express");
const session = require("express-session");
const { MongoStore } = require("connect-mongo");
const { engine } = require("express-handlebars");

const {
  readClientPromise,
  writeClientPromise,
  getReadDb,
  getWriteDb,
} = require("./db");

const app = express();

const MSSV = String(process.env.MSSV || "").trim();
const FULL_NAME = process.env.FULL_NAME || "";
const prefixMatch = MSSV.match(/(\d{3})$/);

if (!prefixMatch) {
  throw new Error("MSSV phải kết thúc bằng ít nhất 3 chữ số");
}

const PREFIX = prefixMatch[1];
const LAST_DIGIT = Number(PREFIX.slice(-1));
const VAT_RATE = LAST_DIGIT + 6;

if (!process.env.SESSION_SECRET) {
  throw new Error("Thiếu SESSION_SECRET");
}

// Render đứng sau reverse proxy.
if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

app.engine(
  "hbs",
  engine({
    extname: ".hbs",
    helpers: {
      money(value) {
        return Number(value).toLocaleString("vi-VN") + " đ";
      },
    },
  })
);

app.set("view engine", "hbs");
app.set("views", "./views");

app.use(express.urlencoded({ extended: false }));
app.use(express.static("public"));

app.use(
  session({
    name: "book.sid",
    secret: process.env.SESSION_SECRET,

    store: MongoStore.create({
      clientPromise: writeClientPromise,
      dbName: process.env.DB_NAME,
      collectionName: "sessions",
      ttl: 60 * 60,
      // Không tự tạo TTL index vì tài khoản ứng dụng không có quyền createIndex.
      autoRemove: "interval",
      autoRemoveInterval: 10,
    }),

    resave: false,
    saveUninitialized: false,

    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 1000,
    },
  })
);

// Dữ liệu dùng chung cho footer của mọi trang.
app.use((req, res, next) => {
  res.locals.student = {
    fullName: FULL_NAME,
    mssv: MSSV,
    vatRate: VAT_RATE,
  };

  next();
});

app.get("/", (req, res) => {
  res.redirect("/books");
});

// READ luôn dùng tài khoản chỉ đọc.
app.get("/books", async (req, res, next) => {
  try {
    const db = await getReadDb();

    const books = await db
      .collection("books")
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    req.session.viewCount = (req.session.viewCount || 0) + 1;

    res.render("books", {
      title: "Danh sách sách",
      books,
      message: req.session.message,
      viewCount: req.session.viewCount,
    });

    delete req.session.message;
  } catch (error) {
    next(error);
  }
});

app.get("/books/new", (req, res) => {
  res.render("new-book", {
    title: "Thêm sách",
    prefix: PREFIX,
    vatRate: VAT_RATE,
  });
});

// WRITE luôn dùng tài khoản ghi.
app.post("/books", async (req, res, next) => {
  try {
    const productCode = String(req.body.productCode || "")
      .trim()
      .toUpperCase();

    const title = String(req.body.title || "").trim();
    const price = Number(req.body.price);

    if (!productCode.startsWith(PREFIX)) {
      return res.status(400).render("new-book", {
        title: "Thêm sách",
        prefix: PREFIX,
        vatRate: VAT_RATE,
        error: `Mã sản phẩm phải bắt đầu bằng ${PREFIX}.`,
        form: { productCode, title, price: req.body.price },
      });
    }

    if (!title) {
      return res.status(400).render("new-book", {
        title: "Thêm sách",
        prefix: PREFIX,
        vatRate: VAT_RATE,
        error: "Tên sách không được để trống.",
        form: { productCode, title, price: req.body.price },
      });
    }

    if (!Number.isFinite(price) || price <= 0) {
      return res.status(400).render("new-book", {
        title: "Thêm sách",
        prefix: PREFIX,
        vatRate: VAT_RATE,
        error: "Giá sách phải là số lớn hơn 0.",
        form: { productCode, title, price: req.body.price },
      });
    }

    const priceAfterVat =
      Math.round(price * (1 + VAT_RATE / 100) * 100) / 100;

    const db = await getWriteDb();

    await db.collection("books").insertOne({
      productCode,
      title,
      priceBeforeVat: price,
      vatRate: VAT_RATE,
      priceAfterVat,
      createdAt: new Date(),
    });

    req.session.message =
      `Đã thêm sách. Giá sau VAT ${VAT_RATE}% là ${priceAfterVat}.`;

    res.redirect("/books");
  } catch (error) {
    next(error);
  }
});

app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

app.use((error, req, res, next) => {
  console.error(error);

  res.status(500).send(
    process.env.NODE_ENV === "production"
      ? "Hệ thống đang gặp lỗi."
      : error.stack
  );
});

const port = Number(process.env.PORT) || 3000;

Promise.all([readClientPromise, writeClientPromise])
  .then(() => {
    app.listen(port, "0.0.0.0", () => {
      console.log(`Server chạy tại cổng ${port}`);
      console.log(`MSSV: ${MSSV}`);
      console.log(`Tiền tố: ${PREFIX}`);
      console.log(`VAT: ${VAT_RATE}%`);
    });
  })
  .catch((error) => {
    console.error("Không thể kết nối MongoDB:", error);
    process.exit(1);
  });
