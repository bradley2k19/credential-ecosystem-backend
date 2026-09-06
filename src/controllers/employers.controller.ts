import { Request, Response } from 'express';

export const placeholder = (req: Request, res: Response) => {
  res.json({ message: 'employers controller placeholder' });
};

export default { placeholder };
