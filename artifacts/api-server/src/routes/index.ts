import { Router, type IRouter } from "express";
import healthRouter from "./health";
import careCompassRouter from "./carecompass";

const router: IRouter = Router();

router.use(healthRouter);
router.use(careCompassRouter);

export default router;
