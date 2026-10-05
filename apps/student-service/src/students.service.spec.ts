import { BadGatewayException, ConflictException } from "@nestjs/common";
import { StudentsService } from "./students.service";

describe("StudentsService.enroll", () => {
  const db = { query: jest.fn() };
  const http = { get: jest.fn() };
  const flags = { isOn: jest.fn().mockReturnValue(true) };
  const svc = new StudentsService(db as any, http as any, flags as any);
  beforeEach(() => { jest.resetAllMocks(); flags.isOn.mockReturnValue(true); });

  it("enrolls when records says eligible", async () => {
    http.get.mockResolvedValue({ eligible: true });
    db.query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 7 }]);
    await expect(svc.enroll(1, 2)).resolves.toMatchObject({ id: 7 });
  });

  it("409s when not eligible", async () => {
    http.get.mockResolvedValue({ eligible: false });
    db.query.mockResolvedValue([]);
    await expect(svc.enroll(1, 2)).rejects.toThrow(ConflictException);
  });

  it("409s on duplicate enrollment without calling records", async () => {
    db.query.mockResolvedValue([{ id: 3 }]);
    await expect(svc.enroll(1, 2)).rejects.toThrow(ConflictException);
    expect(http.get).not.toHaveBeenCalled();
  });

  it("409s on unique violation backstop", async () => {
    http.get.mockResolvedValue({ eligible: true });
    db.query.mockResolvedValueOnce([]).mockRejectedValueOnce(Object.assign(new Error("dup"), { code: "23505" }));
    await expect(svc.enroll(1, 2)).rejects.toThrow(ConflictException);
  });

  it("502s when records unreachable", async () => {
    db.query.mockResolvedValue([]);
    http.get.mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(svc.enroll(1, 2)).rejects.toThrow(BadGatewayException);
  });
});
