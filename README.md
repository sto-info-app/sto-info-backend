# sto-info-backend [![Uptime status](https://img.shields.io/uptimerobot/status/m802169058-d230a9a973c1eef1de28ed63.svg)](https://status.startrekonline.info/) [![Uptime 30 days](https://img.shields.io/uptimerobot/ratio/m802169058-d230a9a973c1eef1de28ed63.svg)](https://status.startrekonline.info/) [![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/sto-info-app/sto-info-backend/badge)](https://scorecard.dev/viewer/?uri=github.com/sto-info-app/sto-info-backend)

## Project Overview

The `sto-info-backend` is a backend service designed to provide information related to STO (Star Trek Online) player's accounts, characters and fleets. It is built using modern web technologies and follows best practices for API development.

## Features

- RESTful API endpoints
- Authentication and authorisation
- Data validation and error handling
- Integration with external services
- Comprehensive logging and monitoring

## Documentation

Documentation is in [docs/](docs/).

- [docs/environment-variables.md](docs/environment-variables.md)
- [docs/infrastructure.md](docs/infrastructure.md)
- [docs/security.md](docs/security.md)
- [docs/database.md](docs/database.md)
- [docs/backend.md](docs/backend.md)
- [docs/frontend.md](docs/frontend.md) (frontend integration expectations)
- [docs/api-endpoints.md](docs/api-endpoints.md)
- [docs/github/SECURITY-AUTOMATION.md](docs/github/SECURITY-AUTOMATION.md)
- [docs/github/QUALITY-AUTOMATION.md](docs/github/QUALITY-AUTOMATION.md)

## Getting Started

### Prerequisites

- Node.js (version 22.x or higher)
- npm (version 10.x or higher)
- PostgreSQL database (version 14.x or higher)
- Redis (version 6.x or higher)
- Amazon Secrets Manager

### Installation

1. Clone the repository:

```sh
git clone https://github.com/steverobertsuk/sto-info-backend.git
```

2. Navigate to the project directory:

```sh
cd sto-info-backend
```

3. Install the dependencies:

```sh
npm install
```

### Configuration

Environment files live in [config/environments/](config/environments/):

- [config/environments/.env](config/environments/.env): used for local development (not committed)
- [config/environments/template.env](config/environments/template.env): starting point for creating your local `.env`
- [config/environments/.env.example](config/environments/.env.example): safe example for hosted environments (e.g. Render)

Create a `.env` file by copying [config/environments/template.env](config/environments/template.env) to [config/environments/.env](config/environments/.env), then amend values to match your local setup.

Environment variables and the required AWS Secrets Manager secret shape are documented in [docs/environment-variables.md](docs/environment-variables.md).

### Database

This application uses PostgreSQL. Schema changes are managed with TypeORM migrations.

Database notes (including retention jobs and dev-only seeding) are in [docs/database.md](docs/database.md).

Migration commands are as follows:

```sh
npm run migration:generate -- -n <NameOfMigration>
npm run migration:run
npm run migration:revert
npm run migration:show
```

### Running the Application

Start the development server:

```sh
npm run start
```

The server will be running at `http://localhost:3000`.

### Running Tests

To run the tests for this project, use the following command:

```sh
npm test
```

This will execute all the unit tests and provide a summary of the test results.

### Deployment

To deploy the application, follow these steps:

1. Build the project:

```sh
npm run build
```

2. Deploy the build artifacts to your preferred hosting service.

## API Documentation

The API documentation is available at `http://localhost:3000/swagger` once the server is running. This documentation is generated using Swagger, which provides a user-friendly interface to explore and test the API endpoints. Swagger will not be loaded if in Production.

## Contributing

We welcome contributions! Please read our [contributing guidelines](CONTRIBUTING.md) for more details.

## Code Quality

We use SonarQube Cloud to ensure the code quality of this project. SonarQube helps us to identify bugs, vulnerabilities, and code smells in our codebase.

[![SonarQube Cloud](https://sonarcloud.io/images/project_badges/sonarcloud-highlight.svg)](https://sonarcloud.io/summary/new_code?id=sto-info-app_sto-info-backend)

### Running SonarQube Analysis

The SonarQube analysis gets run automatically. To access the SonarQube portal for this project, please contact us at [support@startrekonline.info](mailto:support@startrekonline.info) to request being added as a user.

You can learn more about SonarQube from their [official website](https://www.sonarsource.com/products/sonarcloud/).

### Configure SonarQube Analysis in Visual Studio Code

Install the [SonarQube IDE](https://www.sonarsource.com/products/sonarlint/) and configure your `.vscode/settings.json` file to include this configuration:

```json
{
  "sonarCloudOrganization": "steverobertsuk",
  "projectKey": "sto-info-app_sto-info-backend"
}
```

The analysis results will be available on the SonarQube dashboard.

### Current SonarQube Analysis

[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=sto-info-app_sto-info-backend&metric=alert_status&token=112872819709705c46aa22a30dbc9cb78546a38e)](https://sonarcloud.io/summary/new_code?id=sto-info-app_sto-info-backend) [![Bugs](https://sonarcloud.io/api/project_badges/measure?project=sto-info-app_sto-info-backend&metric=bugs&token=112872819709705c46aa22a30dbc9cb78546a38e)](https://sonarcloud.io/summary/new_code?id=sto-info-app_sto-info-backend) [![Code Smells](https://sonarcloud.io/api/project_badges/measure?project=sto-info-app_sto-info-backend&metric=code_smells&token=112872819709705c46aa22a30dbc9cb78546a38e)](https://sonarcloud.io/summary/new_code?id=sto-info-app_sto-info-backend) [![Duplicated Lines (%)](https://sonarcloud.io/api/project_badges/measure?project=sto-info-app_sto-info-backend&metric=duplicated_lines_density&token=112872819709705c46aa22a30dbc9cb78546a38e)](https://sonarcloud.io/summary/new_code?id=sto-info-app_sto-info-backend)

## Contributors

<!-- README_CONTRIBUTORS -->
<!-- README_CONTRIBUTORS -->

## Licence

This project is licensed under the MIT Licence. See the [LICENCE](LICENCE) file for more information.

## Intellectual Property Rights

This app respects the copyright and intellectual property rights of Star Trek Online and Star Trek. CBS Studios Inc. owns STAR TREK, and Cryptic Studios Inc owns STAR TREK ONLINE with all their related marks, logos and characters.

## Contact

For any enquiries, please contact us at [support@startrekonline.info](mailto:support@startrekonline.info).
