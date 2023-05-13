import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { convert as htmlToText } from 'html-to-text';
import { MailService } from 'src/mail/mail.service';
import { User } from 'src/user/entities/user.entity';
import { UserService } from 'src/user/user.service';
import { Repository } from 'typeorm';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private jwtService: JwtService,
    private userService: UserService,
    private mailService: MailService,
  ) {}

  async register(user: Partial<User>): Promise<User> {
    if (await this.doesEmailExist(user.email)) {
      throw new ConflictException('Email already in use');
    }

    if (await this.doesUsernameExist(user.username)) {
      throw new ConflictException('Username already in use');
    }

    const hashedPassword = await bcrypt.hash(user.password, 8);
    const newUser = this.userRepository.create({
      email: user.email,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      password: hashedPassword,
    });

    const verificationToken = this.generateEmailVerificationToken();
    newUser.emailVerificationToken = verificationToken;
    newUser.emailVerificationTokenExpiry =
      this.generateEmailVerificationExpiryDate();

    const savedUser = await this.userRepository.save(newUser);

    if (savedUser) {
      const verificationToken = crypto.randomBytes(32).toString('hex');
      savedUser.emailVerificationToken = verificationToken;
      await this.userRepository.save(savedUser);

      this.mailService.sendVerificationEmail(
        savedUser.email,
        verificationToken,
      );

      return savedUser;
    } else {
      throw new Error('User could not be saved');
    }
  }

  async verifyEmail(token: string): Promise<User> {
    if (!token) {
      throw new BadRequestException('Token missing');
    }

    const user = await this.userRepository.findOne({
      where: { emailVerificationToken: token },
    });

    if (!user) {
      throw new NotFoundException('Invalid token');
    }

    if (new Date() > user.emailVerificationTokenExpiry) {
      throw new BadRequestException('Token expired');
    }

    user.emailVerified = true;
    user.emailVerificationToken = null;
    user.emailVerificationTokenExpiry = null;

    const updatedUser = await this.userRepository.save(user);

    // Send welcome email
    const loginUrl = process.env.APP_FRONTEND_URL + '/login';
    const termsOfUseUrl = process.env.APP_FRONTEND_URL + '/terms-of-use';
    const emailSubject = `Welcome to the ${process.env.APP_TITLE}`;
    const emailHtmlContent = `Jolan tru ${user.firstName},

    <p>Welcome to the ${process.env.APP_TITLE}.</p>
    
    <p>The ${process.env.APP_TITLE} is a fan site of Star Trek Online and, of course, Star Trek.</p>
    
    <p>Hopefully, you will find this portal helpful in tracking the status of your Star Trek Online accounts, characters, fleets and more.</p>
    
    <p>You can access the ${process.env.APP_TITLE} via: <a href="${loginUrl}" target="_blank">${loginUrl}</a>.</p>

    
    <p>The portal gets provided to users as a free resource to the Star Trek Online community, and by using this portal, you agree to the terms of use that can be found at: <a href="${termsOfUseUrl}" target="_blank">${termsOfUseUrl}</a>.</p>

    <p>CBS Studios Inc. owns STAR TREK, and Cryptic Studios Inc owns STAR TREK ONLINE with all their related marks, logos and characters.<br/>
    The creators of this portal have no connection with CBS Studios Inc., Cryptic Studios Inc., or any other copyright holders.<br/>
    The ${process.env.APP_TITLE} is made by fans, for fans.</p>
    
    <p><em>This is an automated email, and replies will not get received.</em></p>`;
    const emailTextContent = htmlToText(emailHtmlContent);
    await this.mailService.sendEmailToUser(
      user.email,
      emailSubject,
      emailTextContent,
      emailHtmlContent,
    );

    return updatedUser;
  }

  async resendVerificationEmail(token: string): Promise<void> {
    const user = await this.userRepository.findOne({
      where: { emailVerificationToken: token },
    });

    if (!user) {
      throw new NotFoundException('User token not found');
    }

    if (user.emailVerified) {
      throw new BadRequestException('Email is already verified');
    }

    const verificationToken = this.generateEmailVerificationToken();
    user.emailVerificationToken = verificationToken;
    user.emailVerificationTokenExpiry =
      this.generateEmailVerificationExpiryDate();

    await this.userRepository.save(user);

    await this.mailService.sendVerificationEmail(user.email, verificationToken);
  }

  async validateUser(email: string, password: string): Promise<any> {
    const user = await this.userService.findByEmail(email);
    if (user && (await user.comparePassword(password))) {
      // Update last login time
      user.lastLogin = new Date();
      await this.userService.update(user.id, user);

      // Remove password from user object before returning it
      const { password, ...result } = user;
      return result;
    }
    return null;
  }

  async validateUserFromPayload(payload: any): Promise<User | null> {
    const user = await this.userRepository.findOne({
      where: { id: payload.sub },
    });
    if (user) {
      return user;
    }
    return null;
  }

  async login(user: User): Promise<{ access_token: string }> {
    const payload = { email: user.email, sub: user.id };
    return {
      access_token: this.jwtService.sign(payload),
    };
  }

  async doesUsernameExist(username: string): Promise<boolean> {
    const count = await this.userRepository.count({ where: { username } });
    return count > 0;
  }

  async doesEmailExist(email: string): Promise<boolean> {
    const count = await this.userRepository.count({ where: { email } });
    return count > 0;
  }

  generateEmailVerificationToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  generateEmailVerificationExpiryDate(): Date {
    return new Date(Date.now() + 3600000); // Token expires in 1 hour
  }
}
