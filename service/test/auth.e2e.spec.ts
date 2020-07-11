import * as request from "supertest";
import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import { AppModule } from "../src/app.module";

describe("AuthModule (e2e)", () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  const signUpData = {
    username: "Jinxing Lin",
    email: "172601673@qq.com",
    password: "123456",
  };

  it("/auth/sign-up (POST)", () => {
    return request(app.getHttpServer())
      .post("/auth/sign-in")
      .send(signUpData)
      .expect(201);
  });

  it("/auth/sign-up (POST)", () => {
    return request(app.getHttpServer())
      .post("/auth/password")
      .send(signUpData)
      .expect(201);
  });

  afterEach(async () => {
    app.close();
  });
});
