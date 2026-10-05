import { Body, Controller, Get, Post } from "@nestjs/common";
import { StudentsService } from "./students.service";

@Controller()
export class StudentsController {
  constructor(private svc: StudentsService) {}

  @Post("students") create(@Body() b: { name: string; email: string }) { return this.svc.create(b.name, b.email); }
  @Get("students") list() { return this.svc.list(); }
  @Post("enrollments") enroll(@Body() b: { studentId: number; courseId: number }) { return this.svc.enroll(Number(b.studentId), Number(b.courseId)); }
}
