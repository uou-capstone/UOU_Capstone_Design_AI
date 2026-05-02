export interface ExamClock {
  now(): Date;
}

export class SystemExamClock implements ExamClock {
  now(): Date {
    return new Date();
  }
}
